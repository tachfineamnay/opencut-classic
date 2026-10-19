
import {
	IndexedDBAdapter,
	deleteDatabase,
} from "@/services/storage/indexeddb-adapter";
import type { StorageMigration } from "./base";
import type { ProjectRecord } from "./transformers/types";
import { getProjectId, isRecord } from "./transformers/utils";

export interface StorageMigrationResult {
	migratedCount: number;
}

export interface MigrationProgress {
	isMigrating: boolean;
	fromVersion: number | null;
	toVersion: number | null;
	projectName: string | null;
}

let hasCleanedUpMetaDb = false;

const MIN_MIGRATION_DISPLAY_MS = 1000;

export async function runStorageMigrations({
	migrations,
	onProgress,
}: {
	migrations: StorageMigration[];
	onProgress?: (progress: MigrationProgress) => void;
}): Promise<StorageMigrationResult> {
	// One-time cleanup: delete the old global version database
	if (!hasCleanedUpMetaDb) {
		try {
			await deleteDatabase({
				dbName: "video-editor-meta",
			});
		} catch {
			// Ignore errors - DB might not exist
		}
		hasCleanedUpMetaDb = true;
	}

	// Initialize IndexedDB adapter using object configuration
	const projectsAdapter = new IndexedDBAdapter<ProjectRecord>({
		dbName: "video-editor-projects",
		storeName: "projects",
		version: 1,
	});

	const projects = await projectsAdapter.getAll();

	const orderedMigrations = [...migrations].sort(
		(a, b) => a.from - b.from,
	);

	let migratedCount = 0;
	let migrationStartTime: number | null = null;

	for (const project of projects) {
		if (typeof project !== "object" || project === null) {
			continue;
		}

		let projectRecord = project as ProjectRecord;

		const projectId = getProjectId({
			project: projectRecord,
		});

		if (!projectId) {
			continue;
		}

		let currentVersion = getProjectVersion({
			project: projectRecord,
		});

		const targetVersion =
			orderedMigrations.at(-1)?.to ?? currentVersion;

		if (currentVersion >= targetVersion) {
			continue;
		}

		// Track when the migration dialog is first displayed
		if (migrationStartTime === null) {
			migrationStartTime = Date.now();
		}

		const projectName = getProjectName({
			project: projectRecord,
		});

		onProgress?.({
			isMigrating: true,
			fromVersion: currentVersion,
			toVersion: targetVersion,
			projectName,
		});

		for (const migration of orderedMigrations) {
			if (migration.from !== currentVersion) {
				continue;
			}

			const result = await migration.run({
				projectId,
				project: projectRecord,
			});

			if (result.skipped) {
				break;
			}

			// Persist the migrated project using the
			// IndexedDBAdapter object-based API
			await projectsAdapter.set({
				key: projectId,
				value: result.project,
			});

			migratedCount++;
			currentVersion = migration.to;
			projectRecord = result.project;
		}
	}

	// Ensure the migration dialog remains visible
	// for at least the minimum duration
	if (migrationStartTime !== null) {
		const elapsed = Date.now() - migrationStartTime;

		if (elapsed < MIN_MIGRATION_DISPLAY_MS) {
			await new Promise<void>((resolve) =>
				setTimeout(
					resolve,
					MIN_MIGRATION_DISPLAY_MS - elapsed,
				),
			);
		}
	}

	onProgress?.({
		isMigrating: false,
		fromVersion: null,
		toVersion: null,
		projectName: null,
	});

	return {
		migratedCount,
	};
}

function getProjectVersion({
	project,
}: {
	project: ProjectRecord;
}): number {
	const versionValue = project.version;

	// v2 and up: explicit version field
	if (typeof versionValue === "number") {
		return versionValue;
	}

	// v1: project contains scenes
	const scenesValue = project.scenes;

	if (Array.isArray(scenesValue) && scenesValue.length > 0) {
		return 1;
	}

	// v0: no scenes
	return 0;
}

function getProjectName({
	project,
}: {
	project: ProjectRecord;
}): string | null {
	const metadata = project.metadata;

	if (
		isRecord(metadata) &&
		typeof metadata.name === "string"
	) {
		return metadata.name;
	}

	// v0: name stored directly on project
	if (typeof project.name === "string") {
		return project.name;
	}

	return null;
}
