import { ASR_FILETRANS_MODELS, DEFAULT_ASR_MODEL } from "@lyre/api/contracts/asr";
import { AudioWaveform, Check, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface AsrSettings {
	model: string;
}

export function AsrSettingsSection() {
	const [model, setModel] = useState<string>(DEFAULT_ASR_MODEL);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		fetch("/api/settings/asr")
			.then((r) => r.json())
			.then((data: AsrSettings) => {
				setModel(data.model);
				setLoaded(true);
			})
			.catch(() => setLoaded(true));
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setSaved(false);
		try {
			const res = await fetch("/api/settings/asr", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model }),
			});
			if (res.ok) {
				const data: AsrSettings = await res.json();
				setModel(data.model);
				setSaved(true);
				setTimeout(() => setSaved(false), 2000);
			}
		} finally {
			setSaving(false);
		}
	}, [model]);

	if (!loaded) {
		return (
			<div className="rounded-card bg-secondary p-5 h-full">
				<div className="flex items-center justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-card bg-secondary p-5 h-full flex flex-col">
			<div className="mb-4 flex items-center gap-3">
				<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
					<AudioWaveform className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
				</div>
				<div>
					<h2 className="text-sm font-medium text-foreground">ASR Configuration</h2>
					<p className="text-xs text-muted-foreground">
						Select the speech recognition model for transcription.
					</p>
				</div>
			</div>

			<div>
				<Label className="text-sm">Model</Label>
				<select
					value={model}
					onChange={(e) => setModel(e.target.value)}
					className="mt-1 h-9 w-full rounded-md border border-border bg-secondary px-3 pr-8 text-sm"
				>
					{ASR_FILETRANS_MODELS.map((m) => (
						<option key={m} value={m}>
							{m}
						</option>
					))}
				</select>
			</div>

			<div className="mt-auto pt-4">
				<Button onClick={handleSave} disabled={saving} className="gap-2" size="sm">
					{saving ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : saved ? (
						<Check className="h-3.5 w-3.5" />
					) : (
						<Save className="h-3.5 w-3.5" strokeWidth={1.5} />
					)}
					{saved ? "Saved" : "Save"}
				</Button>
			</div>
		</div>
	);
}
