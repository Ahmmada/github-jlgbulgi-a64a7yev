// components/SyncIndicator.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { syncManager, SyncResult } from '@/lib/syncManager';
import { getUnsyncedChangesCount, getSyncStats } from '@/lib/syncQueueDb';

interface SyncIndicatorProps {
  onSyncComplete?: (result: SyncResult) => void;
  showDetails?: boolean;
}

export default function SyncIndicator({ onSyncComplete, showDetails = false }: SyncIndicatorProps) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncStats, setSyncStats] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });

    const updateCounts = async () => {
      const count = await getUnsyncedChangesCount();
      setUnsyncedCount(count);
      
      if (showDetails) {
        const stats = await getSyncStats();
        setSyncStats(stats);
      }
    };

    updateCounts();
    const interval = setInterval(updateCounts, 5000); // تحديث كل 5 ثوان

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [showDetails]);

  const handleSync = async () => {
    if (!isConnected) {
      Alert.alert('لا يوجد اتصال', 'يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.');
      return;
    }

    if (isSyncing) {
      Alert.alert('المزامنة قيد التشغيل', 'يرجى انتظار انتهاء المزامنة الحالية.');
      return;
    }

    setIsSyncing(true);
    try {
      const result = await syncManager.syncAll();
      
      if (result.success) {
        Alert.alert('نجحت المزامنة', result.message);
        setLastSyncTime(new Date());
      } else {
        Alert.alert('فشلت المزامنة', result.message);
      }
      
      // تحديث العدادات
      const newCount = await getUnsyncedChangesCount();
      setUnsyncedCount(newCount);
      
      if (showDetails) {
        const stats = await getSyncStats();
        setSyncStats(stats);
      }
      
      onSyncComplete?.(result);
    } catch (error: any) {
      Alert.alert('خطأ في المزامنة', error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusColor = () => {
    if (!isConnected) return '#ef4444'; // أحمر - غير متصل
    if (unsyncedCount > 0) return '#f59e0b'; // برتقالي - يحتاج مزامنة
    return '#22c55e'; // أخضر - متزامن
  };

  const getStatusText = () => {
    if (!isConnected) return 'غير متصل';
    if (isSyncing) return 'جاري المزامنة...';
    if (unsyncedCount > 0) return `${unsyncedCount} تغيير معلق`;
    return 'متزامن';
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.syncButton, { backgroundColor: getStatusColor() }]}
        onPress={handleSync}
        disabled={!isConnected || isSyncing}
      >
        {isSyncing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons 
            name={isConnected ? (unsyncedCount > 0 ? "sync-outline" : "checkmark-circle-outline") : "cloud-offline-outline"} 
            size={20} 
            color="#fff" 
          />
        )}
        <Text style={styles.syncButtonText}>{getStatusText()}</Text>
        {unsyncedCount > 0 && !isSyncing && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unsyncedCount}</Text>
          </View>
        )}
      </TouchableOpacity>
      
      {showDetails && syncStats && (
        <View style={styles.detailsContainer}>
          <Text style={styles.detailsTitle}>تفاصيل المزامنة:</Text>
          {Object.entries(syncStats.byEntity).map(([entity, count]) => (
            <Text key={entity} style={styles.detailsText}>
              {entity}: {count as number}
            </Text>
          ))}
          {lastSyncTime && (
            <Text style={styles.lastSyncText}>
              آخر مزامنة: {lastSyncTime.toLocaleTimeString('ar-SA')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    position: 'relative',
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#dc2626',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  detailsContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  detailsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 4,
  },
  detailsText: {
    fontSize: 11,
    color: '#6b7280',
  },
  lastSyncText: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
    fontStyle: 'italic',
  },
});