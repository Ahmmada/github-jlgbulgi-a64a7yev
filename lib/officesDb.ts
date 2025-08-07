// lib/officesDb.ts
import { getDb } from './database';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';

export const getLocalOffices = async (): Promise<Office[]> => {
  const db = getDb();
  const result = await db.getAllAsync(
    'SELECT * FROM offices WHERE (deleted_at IS NULL OR deleted_at = "") ORDER BY id ASC;'
  );
  return result as Office[];
};

export const insertLocalOffice = async (office: {
  name: string;
  supabase_id?: number;
}): Promise<{ localId: number; uuid: string }> => {
  const db = getDb();
  const now = new Date().toISOString();
  const newUuid = uuidv4();

  const existing = await db.getFirstAsync(
    'SELECT * FROM offices WHERE name = ? AND (deleted_at IS NULL OR deleted_at = "")',
    [office.name]
  );
  if (existing) {
    throw new Error('اسم المركز موجود بالفعل');
  }

  const result = await db.runAsync(
    `INSERT INTO offices (uuid, name, supabase_id, is_synced, operation_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      newUuid,
      office.name,
      office.supabase_id,
      office.supabase_id ? 1 : 0,
      office.supabase_id ? null : 'INSERT',
      now,
      now
    ]
  );

  const insertId = result.lastInsertRowId as number;

  if (!office.supabase_id) {
    await db.runAsync(
      'INSERT INTO sync_queue (entity, entity_local_id, entity_uuid, operation, payload) VALUES (?, ?, ?, ?, ?);',
      ['offices', insertId, newUuid, 'INSERT', JSON.stringify({
        name: office.name,
        created_at: now,
        updated_at: now,
        uuid: newUuid
      })]
    );
  }

  return { localId: insertId, uuid: newUuid };
};

export const updateLocalOffice = async (localId: number, name: string): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();

  const office = await db.getFirstAsync('SELECT uuid, name, supabase_id FROM offices WHERE id = ?;', [localId]);
  if (!office) throw new Error('المركز غير موجود محلياً');

  const existing = await db.getFirstAsync(
    'SELECT * FROM offices WHERE name = ? AND id != ? AND (deleted_at IS NULL OR deleted_at = "")',
    [name, localId]
  );
  if (existing) {
    throw new Error('اسم المركز موجود بالفعل');
  }

  await db.runAsync(
    'UPDATE offices SET name = ?, is_synced = 0, operation_type = "UPDATE", updated_at = ? WHERE id = ?;',
    [name, now, localId]
  );

  await db.runAsync(
    `INSERT OR REPLACE INTO sync_queue
     (entity, entity_local_id, entity_uuid, entity_supabase_id, operation, payload)
     VALUES (?, ?, ?, (SELECT supabase_id FROM offices WHERE id = ?), ?, ?);`,
    ['offices', localId, office.uuid, localId, 'UPDATE', JSON.stringify({
      name,
      updated_at: now,
      uuid: office.uuid
    })]
  );
};

export const deleteLocalOffice = async (localId: number): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();

  const office = await db.getFirstAsync('SELECT uuid, supabase_id FROM offices WHERE id = ?;', [localId]);
  if (!office) throw new Error('المركز غير موجود محلياً');

  await db.runAsync(
    'UPDATE offices SET deleted_at = ?, is_synced = 0, operation_type = "DELETE", updated_at = ? WHERE id = ?;',
    [now, now, localId]
  );

  await db.runAsync(
    'INSERT INTO sync_queue (entity, entity_local_id, entity_uuid, entity_supabase_id, operation, payload) VALUES (?, ?, ?, ?, ?, ?);',
    ['offices', localId, office.uuid, office.supabase_id ?? null, 'DELETE', JSON.stringify({
      deleted_at: now,
      updated_at: now,
      uuid: office.uuid
    })]
  );
};

export const markOfficeAsSynced = async (localId: number): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    'UPDATE offices SET is_synced = 1, operation_type = NULL WHERE id = ?;',
    [localId]
  );
};

export const markRemoteDeletedLocally = async (supabaseId: number, deleted_at: string) => {
  const db = getDb();
  await db.runAsync(
    'UPDATE offices SET deleted_at = ?, is_synced = 1, operation_type = NULL WHERE supabase_id = ?;',
    [deleted_at, supabaseId]
  );
};

export const updateLocalOfficeSupabaseId = async (
  localId: number,
  uuid: string,
  supabaseId: number
): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    'UPDATE offices SET supabase_id = ?, is_synced = 1, operation_type = NULL WHERE id = ? AND uuid = ?;',
    [supabaseId, localId, uuid]
  );
};

export const updateLocalOfficeFieldsBySupabase = async (supabaseOffice: any): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    'UPDATE offices SET name = ?, updated_at = ?, is_synced = 1, operation_type = NULL WHERE uuid = ?;',
    [supabaseOffice.name, supabaseOffice.updated_at || supabaseOffice.created_at, supabaseOffice.uuid]
  );
};

export const insertFromSupabaseIfNotExists = async (supabaseOffice: any): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO offices
      (uuid, name, supabase_id, is_synced, operation_type, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 1, NULL, ?, ?, ?);`,
    [
      supabaseOffice.uuid,
      supabaseOffice.name,
      supabaseOffice.id,
      supabaseOffice.created_at || new Date().toISOString(),
      supabaseOffice.updated_at || supabaseOffice.created_at || new Date().toISOString(),
      supabaseOffice.deleted_at || null
    ]
  );
};

export const deleteLocalOfficeByUuidAndMarkSynced = async (uuid: string): Promise<void> => {
  const db = getDb();
  await db.runAsync('DELETE FROM offices WHERE uuid = ?;', [uuid]);
  console.log(`🗑️ Deleted local office (UUID: ${uuid}) after sync failure.`);
};


export const fetchAndSyncRemoteOffices = async (): Promise<void> => { // إزالة userId كمعامل
  const db = getDb();
  try {
    // جلب جميع المراكز من Supabase مع معالجة أفضل للأخطاء
    const { data: remoteOffices, error } = await supabase
      .from('offices')
      .select('*')
      .is('deleted_at', null) // جلب المراكز غير المحذوفة فقط
      .order('id', { ascending: true });

    if (error) throw error;
    
    if (!remoteOffices || remoteOffices.length === 0) {
      console.log('📭 لا توجد مراكز في Supabase للمزامنة');
      return;
    }

    const localOffices = await getLocalOffices(); // جلب البيانات المحلية الحالية

    await db.withTransactionAsync(async () => {
      let insertedCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      
      for (const remoteOffice of remoteOffices) {
        const localOffice = localOffices.find(l => l.uuid === remoteOffice.uuid);

        if (!localOffice) {
          await insertFromSupabaseIfNotExists(remoteOffice);
          insertedCount++;
        } else {
          const remoteUpdate = new Date(remoteOffice.updated_at || remoteOffice.created_at || 0).getTime();
          const localUpdate = new Date(localOffice.updated_at || localOffice.created_at || 0).getTime();

          // تحديث إذا كان البعيد أحدث أو إذا كان المحلي في حالة INSERT (لم يتم مزامنته بعد)
          if (remoteUpdate > localUpdate && localOffice.is_synced === 1) {
            await updateLocalOfficeFieldsBySupabase(remoteOffice);
            updatedCount++;
          }
        }
      }
      
      // التحقق من المراكز المحذوفة بعيدياً
      const { data: deletedOffices, error: deletedError } = await supabase
        .from('offices')
        .select('*')
        .not('deleted_at', 'is', null);
        
      if (!deletedError && deletedOffices) {
        for (const deletedOffice of deletedOffices) {
          const existingLocal = localOffices.find(l => l.uuid === deletedOffice.uuid);
          if (existingLocal && !existingLocal.deleted_at) {
            await markRemoteDeletedLocally(deletedOffice.id, deletedOffice.deleted_at);
            deletedCount++;
          }
        }
      }
      
      console.log(`✅ مزامنة المراكز: إضافة ${insertedCount}, تحديث ${updatedCount}, حذف ${deletedCount}`);
    });
  } catch (error: any) {
    console.error('❌ خطأ في جلب ومزامنة المراكز البعيدة:', error.message);
    throw error;
  }
};




export type Office = {
  id: number;
  uuid: string;
  name: string;
  supabase_id?: number;
  is_synced?: number;
  operation_type?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
};