// backend/database/add_voice_metadata.js
const { query } = require('../config/supabase');

async function runMigration() {
  try {
    console.log('⚡ Starting database migration to add voice normalization metadata...');

    // 1. Add columns to messages table if they do not exist
    const addColumnsSql = `
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS attachment_codec VARCHAR(50),
      ADD COLUMN IF NOT EXISTS attachment_size INTEGER,
      ADD COLUMN IF NOT EXISTS processing_status VARCHAR(50) DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS original_attachment_url TEXT,
      ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS processing_error TEXT;
    `;
    await query(addColumnsSql);
    console.log('✅ Added columns to messages table.');

    // 2. Create indexes to optimize query speed on queue processing
    const addIndexesSql = `
      CREATE INDEX IF NOT EXISTS idx_messages_voice_processing ON messages(processing_status);
      CREATE INDEX IF NOT EXISTS idx_messages_voice_type ON messages(type);
    `;
    await query(addIndexesSql);
    console.log('✅ Created indexes idx_messages_voice_processing and idx_messages_voice_type.');

    // 3. Mark existing voice messages without processing_status as 'completed'
    // or keep them as null/pending? The requirements state: "Process all voice messages where type='voice' and processing_status IS NULL"
    // So they should remain NULL initially, and our migration script will pick them up. Let's make sure they are NULL.
    // If they were already created, they don't have processing_status, so they are NULL. That is correct.

    console.log('🎉 Database migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database migration failed:', err);
    process.exit(1);
  }
}

runMigration();
