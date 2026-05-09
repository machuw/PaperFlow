import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const devnote = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', 'supabase', '.env.local-devnote.md'),
  'utf8',
);
function extract(pattern: RegExp): string {
  const m = devnote.match(pattern);
  if (!m) throw new Error(`Could not find ${pattern} in devnote`);
  return m[1].trim();
}
const SB_URL = extract(/SB_URL=(.+)/);
const SB_ANON = extract(/SB_ANON=(.+)/);
const SB_SERVICE = extract(/SB_SERVICE=(.+)/);

const admin = createClient(SB_URL, SB_SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signupAndLogin(email: string) {
  await admin.auth.admin.createUser({ email, password: 'pw123456', email_confirm: true });
  const client = createClient(SB_URL, SB_ANON);
  const { data } = await client.auth.signInWithPassword({ email, password: 'pw123456' });
  return { client, userId: data.user!.id };
}

describe('libraries+topics RLS', () => {
  it('libraries table exists with user_id, name unique constraint', async () => {
    const tag = `lib-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { client } = await signupAndLogin(`${tag}@test.com`);
    const insert1 = await client.from('libraries').insert({ name: 'Q4' });
    expect(insert1.error).toBeNull();
    const insert2 = await client.from('libraries').insert({ name: 'Q4' });
    expect(insert2.error?.code).toBe('23505');  // unique violation per (user_id, name)
  });

  it('topic_ids column on papers supports contains query (GIN index)', async () => {
    const tag = `gin-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { client, userId } = await signupAndLogin(`${tag}@test.com`);
    // Insert a topic and a paper using it
    const { data: t } = await client.from('topics').insert({ name: 'VLA' }).select().single();
    expect(t).toBeTruthy();
    await client.from('papers').insert({ user_id: userId, paper_key: 'p1', title: 't', authors: [], pages: 1, topic_ids: [t!.id] });
    const { data, error } = await client.from('papers').select('paper_key').contains('topic_ids', [t!.id]);
    expect(error).toBeNull();
    expect(data?.[0]?.paper_key).toBe('p1');
  });
});

describe('delete-library Edge Function', () => {
  it('delete-library function removes catalog row + cascades library_id to null', async () => {
    const tag = `del-lib-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { client, userId } = await signupAndLogin(`${tag}@test.com`);
    const { data: lib, error: insErr } = await client.from('libraries').insert({ name: 'TmpLib' }).select().single();
    expect(insErr).toBeNull();
    await client.from('papers').insert({
      user_id: userId,
      paper_key: `paper-${tag}`,
      title: 't', authors: [], pages: 1,
      library_id: lib!.id,
    });
    const { error } = await client.functions.invoke('delete-library', { body: { id: lib!.id } });
    expect(error).toBeNull();
    const after = await client.from('libraries').select('id').eq('id', lib!.id);
    expect(after.data).toEqual([]);
    const paper = await client.from('papers').select('library_id').eq('paper_key', `paper-${tag}`).single();
    expect(paper.data?.library_id).toBe(null);  // FK on delete set null
  });
});

describe('delete-topic Edge Function', () => {
  it('delete-topic function removes catalog row + array_remove from all papers in tx', async () => {
    const tag = `del-tp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { client, userId } = await signupAndLogin(`${tag}@test.com`);
    const { data: t, error: insErr } = await client.from('topics').insert({ name: 'TmpTopic' }).select().single();
    expect(insErr).toBeNull();
    // Use a UUID for the unrelated topic id so the array type matches uuid[]
    const otherTopicId = crypto.randomUUID();
    await client.from('papers').insert([
      { user_id: userId, paper_key: `p1-${tag}`, title: 't', authors: [], pages: 1, topic_ids: [t!.id] },
      { user_id: userId, paper_key: `p2-${tag}`, title: 't', authors: [], pages: 1, topic_ids: [t!.id, otherTopicId] },
    ]);
    const { error } = await client.functions.invoke('delete-topic', { body: { id: t!.id } });
    expect(error).toBeNull();
    const after = await client.from('topics').select('id').eq('id', t!.id);
    expect(after.data).toEqual([]);
    const papers = await client.from('papers').select('paper_key, topic_ids').in('paper_key', [`p1-${tag}`, `p2-${tag}`]);
    for (const p of papers.data!) {
      expect(p.topic_ids.includes(t!.id)).toBe(false);
    }
  });
});

describe('delete_topic_atomic RPC access control', () => {
  it('delete_topic_atomic RPC is locked from anon/authenticated callers', async () => {
    const tag = `lock-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { client } = await signupAndLogin(`${tag}@test.com`);
    const { error } = await client.rpc('delete_topic_atomic', {
      p_topic_id: crypto.randomUUID(),
      p_user_id: crypto.randomUUID(),
    });
    // Postgres returns 42501 (insufficient_privilege) when EXECUTE is revoked.
    // Or PostgREST may return PGRST202 if the function isn't exposed to the role.
    expect(error).not.toBeNull();
    expect(['42501', 'PGRST202']).toContain(error?.code ?? '');
  });
});
