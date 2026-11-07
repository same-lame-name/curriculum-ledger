-- ~/.config/nvim/lua/core/options.lua
-- Core editor baseline. Configures native Neovim behavior.

-- Line Numbers & Visuals
vim.opt.number = true -- Absolute line number on current line
vim.opt.relativenumber = true -- Relative line numbers for jump targeting
vim.opt.cursorline = true -- Highlight the current line
vim.opt.wrap = false -- Disable line wrapping
vim.opt.scrolloff = 10 -- Minimum lines to keep above/below cursor
vim.opt.sidescrolloff = 10 -- Minimum columns to keep left/right of cursor
vim.opt.signcolumn = "yes" -- Always show signcolumn to prevent text shifting during diagnostics
-- vim.opt.colorcolumn = "125"     -- Visual ruler at 125 characters
vim.opt.showmatch = true -- Briefly jump to matching bracket

-- Tabs & Indentation
vim.opt.tabstop = 2 -- Number of spaces a <Tab> counts for
vim.opt.shiftwidth = 2 -- Number of spaces for auto-indent
vim.opt.softtabstop = 2 -- Number of spaces a <Tab> inserts in insert mode
vim.opt.expandtab = true -- Convert tabs to spaces
vim.opt.smartindent = true -- Context-aware auto-indentation
vim.opt.autoindent = true -- Copy indent from current line when starting a new one

-- Search Behavior
vim.opt.ignorecase = true -- Ignore case in search patterns
vim.opt.smartcase = true -- Override ignorecase if search contains uppercase
vim.opt.hlsearch = true -- Highlight all matches on previous search pattern
vim.opt.incsearch = true -- Show match incrementally as typing

-- UI & Command Line
vim.opt.cmdheight = 0 -- Hide command line unless active. Relies on notifications for execution output.
vim.opt.completeopt = "menuone,noinsert,noselect" -- Configure autocomplete menu behavior
vim.opt.showmode = false -- Hide mode display (e.g., "-- INSERT --") as statusline handles it
vim.opt.pumheight = 10 -- Maximum number of items in popup menu
vim.opt.pumblend = 10 -- Pseudo-transparency for popup menu
vim.opt.winblend = 0 -- Pseudo-transparency for floating windows
vim.opt.conceallevel = 0 -- Do not hide text based on syntax rules
vim.opt.concealcursor = "" -- Do not conceal text while in any mode
vim.opt.lazyredraw = true -- Do not redraw screen while executing macros (performance optimization)
vim.opt.synmaxcol = 300 -- Max column to search for syntax highlighting (performance optimization)
vim.opt.fillchars = { eob = " " } -- Hide trailing tilde (~) characters at EOF

-- Undo & Backup Management
local undodir = vim.fn.expand("~/.vim/undodir")
if vim.fn.isdirectory(undodir) == 0 then
	vim.fn.mkdir(undodir, "p")
end

vim.opt.backup = false -- Disable backup files
vim.opt.writebackup = false -- Disable making a backup before overwriting a file
vim.opt.swapfile = false -- Disable swapfiles to prevent recovery prompts
vim.opt.undofile = true -- Enable persistent undo history across sessions
vim.opt.undodir = undodir -- Directory to store undo history
vim.opt.updatetime = 300 -- Idle time (ms) before triggering CursorHold events
vim.opt.timeoutlen = 500 -- Time (ms) to wait for a mapped sequence to complete
vim.opt.ttimeoutlen = 0 -- Time (ms) to wait for a key code sequence

-- File Operations & Encoding
vim.opt.autoread = true -- Automatically re-read files changed outside of Neovim
vim.opt.autowrite = false -- Do not automatically write a file when leaving buffer
vim.opt.hidden = true -- Allow hiding buffers with unsaved changes
vim.opt.autochdir = false -- Do not auto-change directory to the current file
vim.opt.encoding = "utf-8" -- Internal string encoding

-- Input & Interaction
vim.opt.errorbells = false -- Disable audio bells
vim.opt.backspace = "indent,eol,start" -- Allow backspacing over autoindent, line breaks, and start of insert
vim.opt.iskeyword:append("-") -- Treat hyphenated-words as a single word entity
vim.opt.path:append("**") -- Enable recursive search down into subdirectories for native `find`
vim.opt.selection = "inclusive" -- Behavior of the selection boundary
vim.opt.mouse = "a" -- Enable mouse support in all modes
vim.opt.clipboard:append("unnamedplus") -- Sync Neovim clipboard with system clipboard
vim.opt.modifiable = true -- Allow buffer modifications

-- Cursor Styling
-- Defines shape and blinking behavior per mode (block in Normal, horizontal in Replace, etc.)
vim.opt.guicursor =
	"n-v-c:block,i-ci-ve:block,r-cr:hor20,o:hor50,a:blinkwait700-blinkoff400-blinkon250-Cursor/lCursor,sm:block-blinkwait175-blinkoff150-blinkon175"

-- Folding
vim.opt.foldmethod = "expr" -- Use expression-based folding
vim.opt.foldexpr = "v:lua.vim.treesitter.foldexpr()" -- Hook into Treesitter for AST-aware folds
vim.opt.foldlevel = 99 -- Do not close folds by default

-- Window Splits
vim.opt.splitbelow = true -- Horizontal splits open below the current window
vim.opt.splitright = true -- Vertical splits open to the right of the current window

-- Command Line & Diff Options
vim.opt.wildmenu = true -- Enable enhanced command-line completion
vim.opt.wildmode = "longest:full,full" -- Command-line completion mode behavior
vim.opt.diffopt:append("linematch:60") -- Enable better diffing algorithm

-- Memory & Performance
vim.opt.redrawtime = 10000 -- Time (ms) to wait for syntax highlighting to complete before aborting
vim.opt.maxmempattern = 20000 -- Max memory (KB) allocated for pattern matching

