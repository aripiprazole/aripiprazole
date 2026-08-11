export const portfolioGithubRepositories = [
  "aripiprazole/andesite",
  "aripiprazole/asena",
  "aripiprazole/bupropion",
  "aripiprazole/eq",
  "aripiprazole/plank",
  "aripiprazole/rinha-de-compiler",
  "aripiprazole/trazodone",
  "commune-ai/subspace",
  "woovibr/java-sdk",
] as const;

const portfolioGithubRepositorySet = new Set<string>(
  portfolioGithubRepositories,
);

export const isPortfolioGithubRepository = (
  owner: string,
  repository: string,
): boolean =>
  portfolioGithubRepositorySet.has(
    `${owner.toLowerCase()}/${repository.toLowerCase()}`,
  );
