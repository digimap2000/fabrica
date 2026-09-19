// What a catalogue IS, with no opinion about where its records came from.
//
// This file has no imports, and that is the whole point of it existing
// separately. It was originally one module with the filesystem loader below it,
// which worked until the viewer imported it and the browser dutifully went
// looking for 'node:fs/promises' - a module does not get to be half portable.
// The loaders live beside it and depend on it, never the other way round.

// The catalogue itself knows nothing about where its records came from, which
// is what lets the same one serve a command line reading files and a browser
// that fetched them over HTTP. Only the loaders below differ.
export function catalogueFrom(stubs, stock) {
  // Stock wins a collision, because stock is fabrica's own data for good and a
  // stub is a stand-in for something mechanica will eventually serve. If the
  // two ever name the same id, the stub is the one that is wrong.
  const all = new Map([...stubs, ...stock]);
  return {
    get: (id) => all.get(id) ?? null,
    size: all.size,
    stubbed: [...stubs.keys()],
    records: () => [...all.values()],
  };
}

