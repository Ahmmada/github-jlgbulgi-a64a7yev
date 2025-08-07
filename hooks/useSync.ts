// hooks/useSync.ts
import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { syncManager, SyncResult } from '@/lib/syncManager';
import { getUnsyncedChangesCount } from '@/lib/syncQueueDb';

export interface UseSyncReturn {
  isConnected: boolean | null;
  unsyncedCount: number;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;
  syncAll: () => Promise<void>;
  syncEntity: (entityType: 'offices' | 'levels' | 'students' | 'attendance') => Promise<void>;
  refreshUnsyncedCount: () => Promise<void>;
}

export function useSync(): UseSyncReturn {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  // مراقبة حالة الاتصال
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });

    return unsubscribe;
  }, []);

  // تحديث عدد التغييرات غير المتزامنة
  const refreshUnsyncedCount = useCallback(async () => {
    try {
      const count = await getUnsyncedChangesCount();
      setUnsyncedCount(count);
    } catch (error) {
      console.error('❌ خطأ في جلب عدد التغييرات غير المتزامنة:', error);
    }
  }, []);

  // تحديث العدد دورياً
  useEffect(() => {
    refreshUnsyncedCount();
    const interval = setInterval(refreshUnsyncedCount, 10000); // كل 10 ثوان
    return () => clearInterval(interval);
  }, [refreshUnsyncedCount]);

  // مزامنة شاملة
  const syncAll = useCallback(async () => {
    if (!isConnected) {
      Alert.alert('لا يوجد اتصال', 'يرجى التحقق من اتصالك بالإنترنت.');
      return;
    }

    if (isSyncing) {
      Alert.alert('المزامنة قيد التشغيل', 'يرجى انتظار انتهاء المزامنة الحالية.');
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncManager.syncAll();
      setLastSyncResult(result);
      
      if (result.success) {
        Alert.alert('نجحت المزامنة', result.message);
      } else {
        Alert.alert('فشلت المزامنة', result.message);
      }
      
      await refreshUnsyncedCount();
    } catch (error: any) {
      const errorResult: SyncResult = {
        success: false,
        message: error.message,
        syncedCount: 0,
        failedCount: 1
      };
      setLastSyncResult(errorResult);
      Alert.alert('خطأ في المزامنة', error.message);
    } finally {
      setIsSyncing(false);
    }
  }, [isConnected, isSyncing, refreshUnsyncedCount]);

  // مزامنة كيان محدد
  const syncEntity = useCallback(async (entityType: 'offices' | 'levels' | 'students' | 'attendance') => {
    if (!isConnected) {
      Alert.alert('لا يوجد اتصال', 'يرجى التحقق من اتصالك بالإنترنت.');
      return;
    }

    if (isSyncing) {
      Alert.alert('المزامنة قيد التشغيل', 'يرجى انتظار انتهاء المزامنة الحالية.');
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncManager.syncEntity(entityType);
      setLastSyncResult(result);
      
      if (result.success) {
        Alert.alert('نجحت المزامنة', result.message);
      } else {
        Alert.alert('فشلت المزامنة', result.message);
      }
      
      await refreshUnsyncedCount();
    } catch (error: any) {
      const errorResult: SyncResult = {
        success: false,
        message: error.message,
        syncedCount: 0,
        failedCount: 1
      };
      setLastSyncResult(errorResult);
      Alert.alert('خطأ في المزامنة', error.message);
    } finally {
      setIsSyncing(false);
    }
  }, [isConnected, isSyncing, refreshUnsyncedCount]);

  return {
    isConnected,
    unsyncedCount,
    isSyncing,
    lastSyncResult,
    syncAll,
    syncEntity,
    refreshUnsyncedCount,
  };
}