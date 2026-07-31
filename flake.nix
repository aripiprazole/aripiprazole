{
  description = "Aripiprazole website development";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs?ref=nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_22
            pnpm
          ];
        };
      }
    );
}
