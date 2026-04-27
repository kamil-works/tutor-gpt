// Honcho stubs — conversation/message storage migrated to Supabase.
// This file only exists to satisfy imports that haven't been removed yet.

export const honcho = {} as any;

export async function getHonchoApp() {
  return { id: 'deutschmeister' };
}

export async function getHonchoUser(userId: string) {
  return { id: userId };
}
