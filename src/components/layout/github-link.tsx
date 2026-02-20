import { Github } from "lucide-react";

const GITHUB_URL = "https://github.com/nocoo/lyre";

export function GitHubLink() {
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub repository"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      <Github className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
    </a>
  );
}
