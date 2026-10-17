/** Every line Rust's bundle load reported it could not hold as-is (`dropped`), verbatim. */
export function DroppedLines({ testid, dropped }: { testid: string; dropped: string[] }) {
  if (dropped.length === 0) return null;
  return (
    <div data-testid={testid} className="space-y-1">
      <div className="font-medium text-amber-400">Not carried over as-is:</div>
      <ul className="space-y-1 text-muted-foreground">
        {dropped.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </div>
  );
}
