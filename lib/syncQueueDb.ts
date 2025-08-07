// lib/syncQueueDb.ts
import { getDb } from './database';

export type SyncQueueItem = {
  id: number;
  entity: string;
  entity_local_id?: number;
  entity_uuid?: string;
  entity_supabase_id?: number;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload?: string; // JSON string
  timestamp: number;
};

// إضافة تغيير جديد إلى قائمة المزامنة
export const addToSyncQueue = async (
  entity: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  entity_uuid: string,
  payload?: any
): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    `
    INSERT INTO sync_queue (entity, entity_uuid, operation, payload)
    VALUES (?, ?, ?, ?);
    `,
    [entity, entity_uuid, operation, payload ? JSON.stringify(payload) : null]
  );
};

// جلب جميع التغييرات غير المتزامنة مع إمكانية التصفية حسب نوع الكيان
export const getUnsyncedChanges = async (entityFilter?: string): Promise<any[]> => {
  const db = getDb();
  
  let query = 'SELECT id, entity, entity_local_id, entity_uuid, entity_supabase_id, operation, payload, timestamp FROM sync_queue';
  let params: any[] = [];
  
  if (entityFilter) {
    query += ' WHERE entity = ?';
    params.push(entityFilter);
  }
  
  query += ' ORDER BY timestamp ASC';
  
  const result = await db.getAllAsync(query, params);
  return result;
};

export const clearSyncedChange = async (id: number): Promise<void> => {
  const db = getDb();
  await db.runAsync('DELETE FROM sync_queue WHERE id = ?;', [id]);
};

// جلب عدد التغييرات غير المتزامنة حسب نوع الكيان
export const getUnsyncedChangesCount = async (entityFilter?: string): Promise<number> => {
  const db = getDb();
  
  let query = 'SELECT COUNT(*) as count FROM sync_queue';
  let params: any[] = [];
  
  if (entityFilter) {
    query += ' WHERE entity = ?';
    params.push(entityFilter);
  }
  
  const result = await db.getFirstAsync<{ count: number }>(query, params);
  return result?.count || 0;
};

// مسح جميع التغييرات المتزامنة (للصيانة)
export const clearAllSyncedChanges = async (): Promise<void> => {
  const db = getDb();
  await db.runAsync('DELETE FROM sync_queue;');
};

// جلب إحصائيات المزامنة
export const getSyncStats = async (): Promise<{
  total: number;
  byEntity: Record<string, number>;
  byOperation: Record<string, number>;
}> => {
  const db = getDb();
  
  const totalResult = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sync_queue');
  const total = totalResult?.count || 0;
  
  const entityResults = await db.getAllAsync<{ entity: string; count: number }>(
    'SELECT entity, COUNT(*) as count FROM sync_queue GROUP BY entity'
  );
  
  const operationResults = await db.getAllAsync<{ operation: string; count: number }>(
    'SELECT operation, COUNT(*) as count FROM sync_queue GROUP BY operation'
  );
  
  const byEntity: Record<string, number> = {};
  entityResults.forEach(result => {
    byEntity[result.entity] = result.count;
  });
  
  const byOperation: Record<string, number> = {};
  operationResults.forEach(result => {
    byOperation[result.operation] = result.count;
  });
  
  return { total, byEntity, byOperation };
};