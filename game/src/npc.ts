import * as THREE from 'three';

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  position: [number, number];
  color: number;
  /** Persona handed to the agent as its system instructions. Kept beside the
   *  mesh so a character is one object in the codebase, not a model in one
   *  file and a prompt in another that quietly disagree. */
  persona: string;
  /**
   * Model FQN. Chosen per character rather than globally: dialogue is
   * latency-sensitive in a way a research agent is not, so a character who
   * only reads local state gets the fast model, while one who runs multi-step
   * web lookups gets the stronger one. Falls back to whatever is configured
   * if this id is not available.
   */
  model: string;
  /** Names of MCP servers from Settings -> Connectors, per character. Bran has
   *  no business searching the web, and withholding the tool is more reliable
   *  than instructing him not to use it. */
  mcpServers?: string[];
}

export const NPCS: NpcDef[] = [
  {
    id: 'smith',
    name: 'Bran',
    role: 'blacksmith',
    position: [1.8, -3],
    color: 0xd08b4a,
    model: 'openai/gpt-5-4-mini',
    persona:
      'You are Bran, a blacksmith in the town of Ashford. Blunt, warm underneath, ' +
      'economical with words — two or three sentences unless asked for detail. ' +
      'You can inspect the player\'s inventory and quest state with your tools, and ' +
      'you should, rather than guessing at what they carry. You never invent items ' +
      'that are not in their inventory. Before you take something from a player or ' +
      'change the world, you ask them plainly and wait for an answer.',
  },
  {
    id: 'herald',
    name: 'Wren',
    role: 'town herald',
    position: [-4, 4],
    color: 0x6aa9d0,
    model: 'openai/gpt-5-5',
    mcpServers: ['tavily'],
    persona:
      'You are Wren, herald of Ashford, who trades in news. You are curious about ' +
      'the world beyond the town and you have tools that reach it. When a traveller ' +
      'asks about events, weather, or anything outside Ashford, you look it up and ' +
      'report what you find, in the voice of a medieval herald relaying dispatches ' +
      'from far roads. You cite where word reached you from. You never pretend to ' +
      'know something you did not look up.',
  },
];

export class Npc {
  readonly mesh: THREE.Group;

  constructor(readonly def: NpcDef) {
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.9, 4, 12),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: .7 }),
    );
    body.position.y = 0.92;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8c9a0, roughness: .8 }),
    );
    head.position.y = 1.66;
    this.mesh.add(body, head);
    this.mesh.position.set(def.position[0], 0, def.position[1]);
  }

  /** Squared distance, to skip a sqrt every frame per NPC. */
  distanceToSq(p: THREE.Vector3): number {
    const dx = p.x - this.mesh.position.x;
    const dz = p.z - this.mesh.position.z;
    return dx * dx + dz * dz;
  }

  faceToward(p: THREE.Vector3): void {
    this.mesh.rotation.y = Math.atan2(p.x - this.mesh.position.x, p.z - this.mesh.position.z);
  }
}
