import { createContext, useContext } from 'react';
import type { Store } from './store.ts';

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (store === null) throw new Error('useStore needs a <StoreContext.Provider>');
  return store;
}
