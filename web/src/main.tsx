import { bootstrap } from './app/bootstrap.tsx';
import './styles.css';

// biome-ignore lint/style/noNonNullAssertion: `index.html` liefert #root immer mit
void bootstrap(document.getElementById('root')!);
