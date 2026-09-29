import type { TranscriptionJob } from "@lyre/api/contracts/jobs";
import type { TranscriptionSentence } from "@lyre/api/contracts/recordings";
import { describe, expect, it } from "vitest";
import { findActiveSentenceIndex, toJobStatusVM, toSentenceVM } from "../lib/recording-detail-vm";

describe("local transcription playback", () => {
	it("preserves millisecond offsets, silence and exact sentence boundaries", () => {
		const sentences = [
			{ sentenceId: 0, beginTime: 900, endTime: 4400, text: "First sentence." },
			{ sentenceId: 1, beginTime: 7900, endTime: 9100, text: "第二句话。" },
		].map((sentence) =>
			toSentenceVM({
				...sentence,
				channelId: 0,
				language: "en",
				emotion: "",
			} satisfies TranscriptionSentence),
		);
		expect(sentences[1]?.beginTimeMs).toBe(7900);
		expect(sentences[1]?.startTime).toBe("0:07.9");
		expect(findActiveSentenceIndex(sentences, 0.899)).toBe(-1);
		expect(findActiveSentenceIndex(sentences, 0.9)).toBe(0);
		expect(findActiveSentenceIndex(sentences, 4.4)).toBe(-1);
		expect(findActiveSentenceIndex(sentences, 7.9)).toBe(1);
		expect(findActiveSentenceIndex(sentences, 9.1)).toBe(-1);
	});

	it("shows local Whisper without a cloud recognition charge", () => {
		const job: TranscriptionJob = {
			id: "job",
			recordingId: "recording",
			taskId: "local:whisper.cpp:large",
			status: "SUCCEEDED",
			requestId: null,
			submitTime: null,
			endTime: null,
			usageSeconds: 300,
			errorMessage: null,
			resultUrl: null,
			createdAt: 0,
			updatedAt: 0,
		};
		expect(toJobStatusVM(job)).toMatchObject({
			model: "Whisper · Local",
			estimatedCost: "¥0.00",
			isRunning: false,
			isCompleted: true,
		});
		expect(toJobStatusVM({ ...job, taskId: "cloud-task" })?.estimatedCost).not.toBe("¥0.00");
	});
});
