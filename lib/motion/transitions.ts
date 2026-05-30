import type { Transition } from "framer-motion";

export function slideTransition(reduced: boolean): Transition {
  return reduced ? { duration: 0 } : { type: "spring", damping: 28, stiffness: 280 };
}

export function fadeTransition(reduced: boolean): Transition {
  return reduced ? { duration: 0 } : { duration: 0.2 };
}

export function springTabTransition(reduced: boolean): Transition {
  return reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 };
}
