import Dexie, { type EntityTable } from 'dexie';
import type { Project, ProjectState, Chapter, OutlineData } from './types';

// Database class
export class NovelDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  states!: EntityTable<ProjectState, 'project_id'>;
  chapters!: EntityTable<Chapter, 'id'>; 
  outlines!: EntityTable<OutlineData, 'project_id'>;

  constructor() {
    super('NovelCopilotDB');
    this.version(1).stores({
      projects: 'id, name, created_at',
      states: 'project_id',
      chapters: '[project_id+chapter_index], project_id, chapter_index', 
      outlines: 'project_id'
    });
  }
}

export const db = new NovelDatabase();
