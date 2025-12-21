export type CharacterProfile = {
  id: string;
  name: string;
  role: 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'minor';
  debutChapter: number;
  basic: {
    age: string;
    identity: string;
    appearance: string;
  };
  personality: {
    traits: string[];
    desires: string[];
    fears: string[];
    flaws: string[];
    principles: string[];
  };
  arc: {
    start: string;
    middle: string;
    end: string;
    turningPoints: string[];
  };
  abilities: string[];
  speechStyle: string;
};

export type Relationship = {
  id: string;
  from: string;
  to: string;
  type: string;
  bondStrength: number;
  dynamic: string;
  tension: string;
  secrets: string[];
  evolution: {
    phase: string;
    chapterRange: [number, number];
    status: string;
  }[];
  symmetric: boolean;
};

export type Faction = {
  id: string;
  name: string;
  description: string;
  members: string[];
  enemies: string[];
  allies: string[];
};

export type RelationshipEvent = {
  chapter: number;
  relationshipId: string;
  description: string;
  bondChange: number;
  newStatus?: string;
};

export type CharacterRelationGraph = {
  version: string;
  generatedAt: string;
  protagonists: CharacterProfile[];
  mainCharacters: CharacterProfile[];
  relationships: Relationship[];
  factions: Faction[];
  relationshipEvents: RelationshipEvent[];
};
