-- ~/.config/nvim/lua/core/plugins.lua
-- The Plugin Registry.
-- Strictly handles downloading and loading binaries into the runtime path.
-- NO configuration logic belongs in this file.

-- 1. Declare Plugin Sources (GitHub Repositories)
vim.pack.add({
	-- UI & File Navigation
	"https://www.github.com/echasnovski/mini.nvim",
	"https://www.github.com/nvim-tree/nvim-tree.lua",
	"https://www.github.com/ibhagwan/fzf-lua",
	"https://github.com/folke/which-key.nvim",
	-- Aesthetic
	"https://github.com/ellisonleao/gruvbox.nvim",
	-- Git Integration
	"https://www.github.com/lewis6991/gitsigns.nvim",
	-- Syntax Parsing Engine
	{
		src = "https://github.com/nvim-treesitter/nvim-treesitter",
		branch = "main",
		build = ":TSUpdate",
	},
	-- Language Server Protocol (LSP) & Linting/Formatting
	"https://www.github.com/neovim/nvim-lspconfig",
	"https://github.com/mason-org/mason.nvim",
	"https://github.com/creativenull/efmls-configs-nvim",
	-- Autocompletion & Snippets
	{
		src = "https://github.com/saghen/blink.cmp",
		version = vim.version.range("1.*"),
	},
	"https://github.com/L3MON4D3/LuaSnip",
})

-- 2. Load Plugins into Runtime
-- Helper function to execute Neovim's native packadd command
local function packadd(name)
	vim.cmd("packadd " .. name)
end

packadd("mini.nvim")
packadd("nvim-tree.lua")
packadd("fzf-lua")
packadd("which-key.nvim")
packadd("gruvbox.nvim")
packadd("gitsigns.nvim")
packadd("nvim-treesitter")
packadd("nvim-lspconfig")
packadd("mason.nvim")
packadd("efmls-configs-nvim")
packadd("blink.cmp")
packadd("LuaSnip")
