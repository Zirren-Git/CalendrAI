import type {SqlDriver} from './driver';
import {configureConnection, migrate, type MigrationResult} from './schema';
import {ensureRoutines, seedFavorites} from '../repos/planning';
import {getSettings, seedWidgetLayout} from '../repos/system';
import type {Settings} from '../domain/types';

export interface BootResult {
  migration: MigrationResult;
  settings: Settings;
}

/**
 * Configures, migrates and seeds a database. Safe to call on every launch:
 * migrations are versioned and seeding only happens when a table is empty.
 */
export async function initializeDatabase(db: SqlDriver, now = Date.now()): Promise<BootResult> {
  await configureConnection(db);
  const migration = await migrate(db);
  await seedWidgetLayout(db, now);
  await seedFavorites(db);
  await ensureRoutines(db, now);
  const settings = await getSettings(db);
  return {migration, settings};
}

export {SCHEMA_VERSION} from './schema';
