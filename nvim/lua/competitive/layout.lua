-- ~/.config/nvim/lua/competitive/layout.lua
-- Manages the tri-pane UI split and aggressive buffer synchronization during contests.

local M = {}

-- Isolated augroup for competitive autocommands to prevent global namespace pollution
local autosync_group = vim.api.nvim_create_augroup("CompAutoSync", { clear = true })

-- Constructs the standard competitive environment: Code (Left), Input (Top Right), Output (Bottom Right)
function M.setup_layout()
    if not require("competitive.init").is_active then
        vim.notify("Cannot setup layout: Not in a competitive session.", vim.log.levels.WARN)
        return
    end

    -- Capture the current window ID (the code buffer) before generating splits
    local main_win = vim.fn.winnr()

    -- Generate UI splits for I/O routing
    vim.cmd("vsplit input.txt")
    vim.cmd("split output.txt")
    -- Explicitly route focus back to the primary code buffer using its stored ID
    vim.cmd(main_win .. "wincmd w")
    vim.notify("Competitive layout initialized.", vim.log.levels.INFO)
end

-- Dynamically registers or destroys high-frequency file syncing hooks
function M.toggle_autosync(enable)
    if enable then
        -- Force Neovim to instantly read external file changes (e.g., dispatcher modifying output.txt)
        vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "CursorHoldI", "FocusGained" }, {
            group = autosync_group,
            command = "if mode() != 'c' | checktime | endif",
            pattern = { "*" },
        })

        -- Force immediate disk writes when navigating away from the code buffer.
        -- Essential for ensuring the dispatcher compiles the absolute latest keystrokes.
        vim.api.nvim_create_autocmd({ "WinLeave", "BufLeave" }, {
            group = autosync_group,
            command = "silent! update",
            pattern = { "*" },
        })
    else
        vim.api.nvim_clear_autocmds({ group = "CompAutoSync" })
    end
end

return M
