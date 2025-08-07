// lib/studentsDb.ts
import { getDb } from './database';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';

export type Student = {
  id: number;
  uuid: string;
  name: string;
  birth_date?: string;
  phone?: string;
  address?: string;
  office_uuid: string;
  level_uuid: string;
  office_name?: string;
  level_name?: string;
  supabase_id?: number;
  is_synced?: number;
  operation_type?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
};

export const getLocalStudents = async (): Promise<Student[]> => {
  const db = getDb();
  return await db.getAllAsync<Student>(`
    SELECT s.*, 
           o.name as office_name, 
           l.name as level_name 
    FROM students s
    LEFT JOIN offices o ON s.office_uuid = o.uuid
    LEFT JOIN levels l ON s.level_uuid = l.uuid
    WHERE (s.deleted_at IS NULL OR s.deleted_at = '') 
    ORDER BY s.id ASC;
  `);
};

export const insertLocalStudent = async (student: {
  name: string;
  birth_date?: string;
  phone?: string;
  address?: string;
  office_uuid: string;
  level_uuid: string;
  supabase_id?: number;
}): Promise<{ localId: number; uuid: string }> => {
  const db = getDb();
  const now = new Date().toISOString();
  const newUuid = uuidv4();

  const existing = await db.getFirstAsync(
    'SELECT * FROM students WHERE name = ? AND office_uuid = ? AND level_uuid = ? AND (deleted_at IS NULL OR deleted_at = "")',
    [student.name, student.office_uuid, student.level_uuid]
  );

  if (existing) {
    throw new Error('اسم الطالب موجود بالفعل في هذا المركز والمستوى');
  }

  const result = await db.runAsync(
    `INSERT INTO students (uuid, name, birth_date, phone, address, office_uuid, level_uuid, supabase_id, is_synced, operation_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newUuid,
      student.name,
      student.birth_date || null,
      student.phone || null,
      student.address || null,
      student.office_uuid,
      student.level_uuid,
      student.supabase_id || null,
      student.supabase_id ? 1 : 0,
      student.supabase_id ? null : 'INSERT',
      now,
      now,
    ]
  );

  const insertId = result.lastInsertRowId as number;

  if (!student.supabase_id) {
    await db.runAsync(
      `INSERT INTO sync_queue (entity, entity_local_id, entity_uuid, operation, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'students',
        insertId,
        newUuid,
        'INSERT',
        JSON.stringify({
          name: student.name,
          birth_date: student.birth_date,
          phone: student.phone,
          address: student.address,
          office_uuid: student.office_uuid,
          level_uuid: student.level_uuid,
          created_at: now,
          updated_at: now,
          uuid: newUuid,
        }),
      ]
    );
  }

  return { localId: insertId, uuid: newUuid };
};

export const updateLocalStudent = async (
  localId: number,
  student: {
    name: string;
    birth_date?: string;
    phone?: string;
    address?: string;
    office_uuid: string;
    level_uuid: string;
  }
): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();

  const existingStudent = await db.getFirstAsync<{ uuid: string; supabase_id?: number }>(
    'SELECT uuid, supabase_id FROM students WHERE id = ?',
    [localId]
  );

  if (!existingStudent) throw new Error('الطالب غير موجود محلياً');

  const existingName = await db.getFirstAsync(
    'SELECT * FROM students WHERE name = ? AND office_uuid = ? AND level_uuid = ? AND id != ? AND (deleted_at IS NULL OR deleted_at = "")',
    [student.name, student.office_uuid, student.level_uuid, localId]
  );

  if (existingName) {
    throw new Error('اسم الطالب موجود بالفعل في هذا المركز والمستوى');
  }

  await db.runAsync(
    `UPDATE students SET name = ?, birth_date = ?, phone = ?, address = ?, office_uuid = ?, level_uuid = ?, is_synced = 0, operation_type = "UPDATE", updated_at = ? WHERE id = ?`,
    [
      student.name,
      student.birth_date || null,
      student.phone || null,
      student.address || null,
      student.office_uuid,
      student.level_uuid,
      now,
      localId,
    ]
  );

  await db.runAsync(
    `INSERT OR REPLACE INTO sync_queue
     (entity, entity_local_id, entity_uuid, entity_supabase_id, operation, payload)
     VALUES (?, ?, ?, (SELECT supabase_id FROM students WHERE id = ?), ?, ?)`,
    [
      'students',
      localId,
      existingStudent.uuid,
      localId,
      'UPDATE',
      JSON.stringify({
        name: student.name,
        birth_date: student.birth_date,
        phone: student.phone,
        address: student.address,
        office_uuid: student.office_uuid,
        level_uuid: student.level_uuid,
        updated_at: now,
        uuid: existingStudent.uuid,
      }),
    ]
  );
};

export const deleteLocalStudent = async (localId: number): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();

  const student = await db.getFirstAsync<{ uuid: string; supabase_id?: number }>(
    'SELECT uuid, supabase_id FROM students WHERE id = ?',
    [localId]
  );

  if (!student) throw new Error('الطالب غير موجود محلياً');

  await db.runAsync(
    `UPDATE students SET deleted_at = ?, is_synced = 0, operation_type = "DELETE", updated_at = ? WHERE id = ?`,
    [now, now, localId]
  );

  await db.runAsync(
    `INSERT INTO sync_queue (entity, entity_local_id, entity_uuid, entity_supabase_id, operation, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      'students',
      localId,
      student.uuid,
      student.supabase_id || null,
      'DELETE',
      JSON.stringify({
        deleted_at: now,
        updated_at: now,
        uuid: student.uuid,
      }),
    ]
  );
};

export const markStudentAsSynced = async (localId: number): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    'UPDATE students SET is_synced = 1, operation_type = NULL WHERE id = ?',
    [localId]
  );
};

export const markRemoteDeletedLocally = async (supabaseId: number, deleted_at: string) => {
  const db = getDb();
  await db.runAsync(
    'UPDATE students SET deleted_at = ?, is_synced = 1, operation_type = NULL WHERE supabase_id = ?',
    [deleted_at, supabaseId]
  );
};

export const updateLocalStudentSupabaseId = async (
  localId: number,
  uuid: string,
  supabaseId: number
): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    'UPDATE students SET supabase_id = ?, is_synced = 1, operation_type = NULL WHERE id = ? AND uuid = ?',
    [supabaseId, localId, uuid]
  );
};

export const updateLocalStudentFieldsBySupabase = async (supabaseStudent: any): Promise<void> => {
  const db = getDb();
  
  // جلب office_uuid و level_uuid من قاعدة البيانات المحلية باستخدام supabase_id
  const office = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM offices WHERE supabase_id = ?',
    [supabaseStudent.office_id]
  );
  
  const level = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM levels WHERE supabase_id = ?',
    [supabaseStudent.level_id]
  );

  if (!officeUuid || !levelUuid) {
    console.warn(`⚠️ Cannot find office or level UUID for student ${supabaseStudent.name}`);
    return;
  }

  await db.runAsync(
    `UPDATE students
     SET name = ?, birth_date = ?, phone = ?, address = ?, office_uuid = ?, level_uuid = ?, updated_at = ?, is_synced = 1, operation_type = NULL
     WHERE uuid = ? AND (deleted_at IS NULL OR deleted_at = '')`,
    [
      supabaseStudent.name,
      supabaseStudent.birth_date,
      supabaseStudent.phone,
      supabaseStudent.address,
      officeUuid,
      levelUuid,
      supabaseStudent.updated_at || supabaseStudent.created_at,
      supabaseStudent.uuid,
    ]
  );
};

export const insertFromSupabaseIfNotExists = async (supabaseStudent: any): Promise<void> => {
  const db = getDb();
  
  // استخدام UUID مباشرة إذا كان متوفراً، وإلا جلبه من قاعدة البيانات
  let officeUuid = supabaseStudent.office_uuid;
  let levelUuid = supabaseStudent.level_uuid;
  
  if (!officeUuid && supabaseStudent.office_id) {
    const office = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM offices WHERE supabase_id = ?',
      [supabaseStudent.office_id]
    );
    officeUuid = office?.uuid;
  }
  
  if (!levelUuid && supabaseStudent.level_id) {
    const level = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM levels WHERE supabase_id = ?',
      [supabaseStudent.level_id]
    );
    levelUuid = level?.uuid;
  }

  if (!officeUuid || !levelUuid) {
    console.warn(`⚠️ Cannot insert student ${supabaseStudent.name}: missing office or level UUID`);
    return;
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO students
     (uuid, name, birth_date, phone, address, office_uuid, level_uuid, supabase_id, is_synced, operation_type, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
    [
      supabaseStudent.uuid,
      supabaseStudent.name,
      supabaseStudent.birth_date,
      supabaseStudent.phone,
      supabaseStudent.address,
      officeUuid,
      levelUuid,
      supabaseStudent.id,
      supabaseStudent.created_at || new Date().toISOString(),
      supabaseStudent.updated_at || supabaseStudent.created_at || new Date().toISOString(),
      supabaseStudent.deleted_at || null,
    ]
  );
};

export const deleteLocalStudentByUuidAndMarkSynced = async (uuid: string): Promise<void> => {
  const db = getDb();
  await db.runAsync('DELETE FROM students WHERE uuid = ?', [uuid]);
  console.log(`🗑️ Deleted local student (UUID: ${uuid}) after sync failure.`);
};

export const getStudentByUuid = async (uuid: string): Promise<Student | null> => {
  const db = getDb();
  const result = await db.getFirstAsync<Student>(
    'SELECT * FROM students WHERE uuid = ?',
    [uuid]
  );
  return result || null;
};

export const fetchAndSyncRemoteStudents = async (): Promise<void> => {
  const db = getDb();
  try {
    // جلب الطلاب غير المحذوفين فقط مع معلومات المراكز والمستويات
    const { data: remoteStudents, error } = await supabase
      .from('students')
      .select(`
        *,
        offices!fk_office(uuid),
        levels!fk_level(uuid)
      `)
      .is('deleted_at', null)
      .order('id', { ascending: true });

    if (error) throw error;
    
    if (!remoteStudents || remoteStudents.length === 0) {
      console.log('📭 لا توجد طلاب في Supabase للمزامنة');
      return;
    }

    const localStudents = await getLocalStudents();

    await db.withTransactionAsync(async () => {
      let insertedCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      
      for (const remoteStudent of remoteStudents) {
        // التحقق من وجود معلومات المركز والمستوى
        if (!remoteStudent.offices || !remoteStudent.levels) {
          console.warn(`⚠️ الطالب ${remoteStudent.name} لا يحتوي على معلومات مركز أو مستوى صحيحة`);
          continue;
        }

        const localStudent = localStudents.find(l => l.uuid === remoteStudent.uuid);

        if (!localStudent) {
          // تحويل البيانات للتوافق مع الهيكل المحلي
          const studentData = {
            ...remoteStudent,
            office_uuid: remoteStudent.offices.uuid,
            level_uuid: remoteStudent.levels.uuid,
          };
          await insertFromSupabaseIfNotExists(studentData);
          insertedCount++;
        } else {
          const remoteUpdate = new Date(remoteStudent.updated_at || remoteStudent.created_at || 0).getTime();
          const localUpdate = new Date(localStudent.updated_at || localStudent.created_at || 0).getTime();

          // تحديث إذا كان البعيد أحدث وكان المحلي متزامن
          if (remoteUpdate > localUpdate && localStudent.is_synced === 1) {
            const studentData = {
              ...remoteStudent,
              office_uuid: remoteStudent.offices.uuid,
              level_uuid: remoteStudent.levels.uuid,
            };
            await updateLocalStudentFieldsBySupabase(studentData);
            updatedCount++;
          }
        }
      }
      
      // التحقق من الطلاب المحذوفين بعيدياً
      const { data: deletedStudents, error: deletedError } = await supabase
        .from('students')
        .select('*')
        .not('deleted_at', 'is', null);
        
      if (!deletedError && deletedStudents) {
        for (const deletedStudent of deletedStudents) {
          const existingLocal = localStudents.find(l => l.uuid === deletedStudent.uuid);
          if (existingLocal && !existingLocal.deleted_at) {
            await markRemoteDeletedLocally(deletedStudent.id, deletedStudent.deleted_at);
            deletedCount++;
          }
        }
      }
      
      console.log(`✅ مزامنة الطلاب: إضافة ${insertedCount}, تحديث ${updatedCount}, حذف ${deletedCount}`);
    });
  } catch (error: any) {
    console.error('❌ خطأ في جلب ومزامنة الطلاب البعيدة:', error.message);
    throw error;
  }
};
  // استخدام UUID مباشرة إذا كان متوفراً، وإلا جلبه من قاعدة البيانات
  let officeUuid = supabaseStudent.office_uuid;
  let levelUuid = supabaseStudent.level_uuid;
  
  if (!officeUuid && supabaseStudent.office_id) {
    const office = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM offices WHERE supabase_id = ?',
      [supabaseStudent.office_id]
    );
    officeUuid = office?.uuid;
  }
  
  if (!levelUuid && supabaseStudent.level_id) {
    const level = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM levels WHERE supabase_id = ?',
      [supabaseStudent.level_id]
    );
    levelUuid = level?.uuid;
  }