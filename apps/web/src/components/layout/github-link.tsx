import { LinkButton } from "@nocoo/basalt/components/button";
import { CodeXml } from "lucide-react";
import { HeaderTooltip } from "./header-links";

const GITHUB_URL = "https://github.com/nocoo/lyre";

export function GitHubLink() {
	return (
		<HeaderTooltip label="GitHub repository">
			<LinkButton
				variant="ghost"
				size="icon"
				href={GITHUB_URL}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="GitHub repository"
			>
				<CodeXml className="h-4 w-4" aria-hidden="true" strokeWidth={1.5} />
			</LinkButton>
		</HeaderTooltip>
	);
}
