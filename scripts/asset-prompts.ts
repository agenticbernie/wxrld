export const STYLE_PROMPT = 'Game-ready stylized dark fantasy organic 3D asset, sharp readable silhouette, detailed beveled multipart construction, PBR roughness and metalness, restrained emissive accents, no text or watermark, isolated object, efficient triangulated topology, feet or base at origin, Y up, facing +Z.';
export const ASSET_PROMPTS = {
  'player-wanderer': 'Wandering survivor, articulated human silhouette, leather and bronze armor, layered cloak, angular helm and hand-held blade. Neutral pose for hub preview.',
  'goblin-stalker': 'Hunched woodland goblin with sharp long ears, narrow articulated limbs, asymmetrical leather shoulders and a crooked blade.',
  'stone-golem': 'Heavy golem of layered chipped basalt slabs, broad fists, separated joints and recessed ember runes, grounded feet.',
  'blood-wyvern': 'Blood-red wyvern with ribbed wing spars and leathery membranes, angular horned head, articulated legs and tapering tail.',
  'ancient-pine': 'Ancient twisted pine with flared roots, tapered bent trunk, branching forks, angular clustered needle canopy, hanging vines and mossy bark.',
  'cursed-crystal': 'Uneven clustered jagged crystal blades in a fractured basalt cradle, recessed crimson core and dark metallic prongs.',
  'gold-chest': 'Treasure chest with separate beveled weathered timber slats, inset bronze and gold trim, hinged lid and recessed rune lock.',
  'boss-totem': 'Cursed summoning totem of stacked fractured basalt, branching roots, beveled antler prongs and inset crimson heart.',
  'extraction-altar': 'Circular extraction altar with separate worn stone rings, broken upward prongs, inset luminous runes, mossy edges and an open walkable center.',
} as const;
export type AssetId = keyof typeof ASSET_PROMPTS;
