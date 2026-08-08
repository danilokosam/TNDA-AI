/// <reference types="react/canary" />
import { ViewTransition } from "react";
import type { ReactNode } from "react";

/**
 * Single shared boundary for the route-level crossfade (`.route-fade` in
 * globals.css) — used by each route-group layout instead of every
 * individual `page.tsx`, since every route already falls under one of them.
 * `ViewTransition` only activates on transitions (route navigation is one,
 * per Next's App Router); a plain render or client-state update inside a
 * page does nothing here.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  return <ViewTransition default="route-fade">{children}</ViewTransition>;
}
