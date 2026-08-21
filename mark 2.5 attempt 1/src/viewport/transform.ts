import { type Vec2 } from '../math/vector';

export function screenToWorld(e: React.PointerEvent | PointerEvent, g: SVGGElement): Vec2 {
  const pt = new DOMPoint(e.clientX, e.clientY);
  const { x, y } = pt.matrixTransform(g.getScreenCTM()!.inverse());
  return { x, y };
}

export function worldToScreen(world: Vec2, g: SVGGElement): Vec2 {
  const pt = new DOMPoint(world.x, world.y);
  const { x, y } = pt.matrixTransform(g.getScreenCTM()!);
  return { x, y };
}
