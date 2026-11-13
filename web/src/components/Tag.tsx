import { ConvertArrow } from './icons';

export function Tag({ id, kind }: { id?: string | null; kind: 'src' | 'dst' | 'neutral' }) {
  if (!id) return <span className="tag neutral">?</span>;
  return <span className={`tag ${kind}`}>.{id}</span>;
}

export function PairInline({ from, to }: { from: string; to: string }) {
  return (
    <span className="pair-inline" aria-label={`${from.toUpperCase()} to ${to.toUpperCase()}`}>
      <Tag id={from} kind="src" />
      <ConvertArrow size={22} />
      <Tag id={to} kind="dst" />
    </span>
  );
}
