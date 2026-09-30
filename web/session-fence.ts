/** Client UI ordering only. Server sessions and tenant checks remain authoritative. */
export function createSessionFence() {
  let owner: string | null | undefined;
  let generation = 0;
  return {
    accept(nextOwner: string | null) {
      if (owner !== nextOwner) {
        owner = nextOwner;
        generation++;
      }
    },
    capture() { return generation; },
    runIfCurrent(captured: number, callback: () => void) {
      if (captured !== generation) return false;
      callback();
      return true;
    },
  };
}
