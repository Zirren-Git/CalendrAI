import {OpSqliteDriver} from './opSqliteDriver';
import {initializeDatabase, type BootResult} from './index';
import type {SqlDriver} from './driver';

export interface AppDatabase {
  driver: SqlDriver;
  boot: BootResult;
}

/**
 * Opens the app's single SQLite file in app-private storage. The same file is
 * read by the native launcher-widget provider, so there is exactly one source
 * of truth for both surfaces.
 */
export async function openAppDatabase(): Promise<AppDatabase> {
  const driver = OpSqliteDriver.openDatabase('dayloom.db');
  try {
    const boot = await initializeDatabase(driver);
    return {driver, boot};
  } catch (error) {
    driver.close();
    throw error;
  }
}
