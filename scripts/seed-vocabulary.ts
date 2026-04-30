import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface VocabEntry {
  word: string;
  article: string;
  translation_tr: string;
  example_sentence: string;
  topic: string;
  pos: string;
}

async function seed() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: npx ts-node scripts/seed-vocabulary.ts <user_id>');
    console.error('Find your user_id in Supabase Dashboard → Authentication → Users');
    process.exit(1);
  }

  const dataPath = path.resolve(__dirname, '../data/a1-vocabulary.json');
  const words: VocabEntry[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const rows = words.map((w) => ({
    user_id: userId,
    word: w.word,
    article: w.article,
    translation_tr: w.translation_tr,
    example_sentence: w.example_sentence,
    topic: w.topic,
    pos: w.pos,
    status: 'new',
    next_review_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('vocabulary_cards')
    .upsert(rows, { onConflict: 'user_id,word' });

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log(`✅ Seeded ${rows.length} vocabulary cards for user ${userId}`);
}

seed();
