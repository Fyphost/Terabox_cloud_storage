export default function PlayerSkeleton() {
  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted"
      aria-hidden
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-bg to-muted" />
    </div>
  );
}
