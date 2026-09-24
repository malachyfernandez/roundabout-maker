import { type Vec2 } from '../math/vector';

export function screenToWorld(e: { clientX: number; clientY: number }, g: SVGGraphicsElement): Vec2 {
  const pt = new DOMPoint(e.clientX, e.clientY);
  const { x, y } = pt.matrixTransform(g.getScreenCTM()!.inverse());
  return { x, y };
}

export function worldToScreen(world: Vec2, g: SVGGraphicsElement): Vec2 {
  const pt = new DOMPoint(world.x, world.y);
  const { x, y } = pt.matrixTransform(g.getScreenCTM()!);
  return { x, y };
}
