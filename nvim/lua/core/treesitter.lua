-- ~/.config/nvim/lua/core/treesitter.lua
-- AST Parsing Engine.
-- Handles syntax highlighting, code folding intelligence, and semantic parsing.

-- Isolated augroup for Treesitter attachment events
local ts_augroup = vim.api.nvim_create_augroup("UserTreesitter", { clear = true })

local function setup_treesitter()
    local treesitter = require("nvim-treesitter")
    -- Initialize the base engine
    treesitter.setup({})
    -- Define the required parser registry
    local ensure_installed = {
        "vim", "vimdoc", "rust", "c", "cpp", "go", "html", "css",
        "javascript", "json", "lua", "markdown", "python", "typescript",
        "vue", "svelte", "bash", "java",
    }

    local config = require("nvim-treesitter.config")
    local already_installed = config.get_installed()
    local parsers_to_install = {}

    -- Diff the requested parsers against the locally installed binaries
    for _, parser in ipairs(ensure_installed) do
        if not vim.tbl_contains(already_installed, parser) then
            table.insert(parsers_to_install, parser)
        end
    end

    -- Trigger asynchronous compilation for missing parsers
    if #parsers_to_install > 0 then
        treesitter.install(parsers_to_install)
    end

    -- Attach Treesitter syntax highlighting dynamically upon opening a file.
    -- Replaces Neovim's legacy regex-based highlighting for supported filetypes.
    vim.api.nvim_create_autocmd("FileType", {
        group = ts_augroup,
        callback = function(args)
            local lang = vim.treesitter.language.get_lang(args.match)
            if lang and vim.list_contains(treesitter.get_installed(), lang) then
                vim.treesitter.start(args.buf)
            end
        end,
    })
end

setup_treesitter()
