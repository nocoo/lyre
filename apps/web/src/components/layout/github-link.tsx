import { Button } from "@nocoo/basalt";
import { Github } from "lucide-react";

const GITHUB_URL = "https://github.com/nocoo/lyre";

export function GitHubLink() {
	return (
		<Button variant="ghost" size="icon" asChild aria-label="GitHub repository">
			<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
				<Github className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
			</a>
		</Button>
	);
}
