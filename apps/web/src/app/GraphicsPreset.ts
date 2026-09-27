export type GraphicsPresetName = 'Low' | 'Medium' | 'High' | 'Ultra';

export interface GraphicsPreset {
  name: GraphicsPresetName;
  pixelRatioCap: number;
  cascades: number;
  gtao: boolean;
  bloom: boolean;
  grassInstances: number;
  waterRes: number;
  hdriRes: '2k' | '4k';
  treeDetail: 'low' | 'medium' | 'high';
}

export const GRAPHICS_PRESETS: Record<GraphicsPresetName, GraphicsPreset> = {
  Low: { name: 'Low', pixelRatioCap: 1, cascades: 2, gtao: false, bloom: false, grassInstances: 8000, waterRes: 256, hdriRes: '2k', treeDetail: 'low' },
  Medium: { name: 'Medium', pixelRatioCap: 1.25, cascades: 2, gtao: true, bloom: true, grassInstances: 20000, waterRes: 512, hdriRes: '2k', treeDetail: 'medium' },
  High: { name: 'High', pixelRatioCap: 1.5, cascades: 3, gtao: true, bloom: true, grassInstances: 40000, waterRes: 512, hdriRes: '2k', treeDetail: 'high' },
  Ultra: { name: 'Ultra', pixelRatioCap: 1.5, cascades: 3, gtao: true, bloom: true, grassInstances: 60000, waterRes: 1024, hdriRes: '4k', treeDetail: 'high' },
};

export function getGraphicsPreset(name: string | null): GraphicsPreset {
  return GRAPHICS_PRESETS[(name as GraphicsPresetName) ?? 'High'] ?? GRAPHICS_PRESETS.High;
}
