import { env } from '../env.js';
import { MemoryStore } from './memory.js';
import { SupabaseStore } from './supabase.js';
import type { Store } from './types.js';

export * from './types.js';

export const store: Store = env.STORE_BACKEND === 'memory' ? new MemoryStore() : new SupabaseStore();
