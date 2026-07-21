/**
 * Full-screen loading overlay shown by RequireAuth while `/api/me` is in flight.
 * Intentionally minimal — small logo with a gentle pulse.
 */
export default function LoadingScreen() {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background animate-in fade-in duration-300">
			<div className="flex flex-col items-center gap-3">
				<img
					src="/logo-80.png"
					alt="lyre"
					width={48}
					height={48}
					className="h-12 w-12 animate-pulse opacity-90"
				/>
				<p className="text-xs tracking-wide text-muted-foreground">Loading…</p>
			</div>
		</div>
	);
}
