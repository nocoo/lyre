/**
 * One-shot feedback dialog that fronts the Regenerate button on the
 * recording detail page. Lets the user optionally tell the LLM what
 * to improve about the previous summary; the text is used once, not
 * persisted.
 *
 * Semantics:
 * - Submitting with empty/whitespace input is treated as "just
 *   regenerate", equivalent to the pre-feature one-click behaviour.
 *   The parent decides whether to send `feedback: ""` or omit the
 *   field; this component just hands back what the user typed.
 * - Cancel and X close the dialog without triggering regeneration.
 */

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nocoo/basalt";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

const DEFAULT_MAX_LENGTH = 2000;

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (feedback: string) => void;
	maxLength?: number;
}

export function RegenerateFeedbackDialog({
	open,
	onOpenChange,
	onSubmit,
	maxLength = DEFAULT_MAX_LENGTH,
}: Props) {
	const [feedback, setFeedback] = useState("");

	// Reset the field every time the dialog is opened so a prior draft
	// doesn't leak into an unrelated regenerate later. Clearing only on
	// close is fragile — if the user reopens quickly the state races.
	useEffect(() => {
		if (open) setFeedback("");
	}, [open]);

	const handleSubmit = () => {
		onSubmit(feedback.trim());
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Regenerate summary</DialogTitle>
					<DialogDescription>
						Optionally tell the AI what to improve. Your feedback is used once and not saved.
					</DialogDescription>
				</DialogHeader>

				<InputArea
					autoFocus
					value={feedback}
					onChange={(e) => setFeedback(e.target.value)}
					maxLength={maxLength}
					placeholder="e.g. Focus more on action items and skip the intro."
					className="min-h-32"
				/>

				<div className="flex justify-end text-xs text-basalt-muted-foreground">
					{feedback.length}/{maxLength}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} className="gap-1.5">
						<Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
						Regenerate
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
