`esbuild` is now a declared client devDependency. It was imported directly by test code but resolved only because npm hoists Vite's copy to the top level - a phantom dependency.
