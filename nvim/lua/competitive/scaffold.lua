-- ~/.config/nvim/lua/competitive/scaffold.lua
-- Automates contest directory creation and injects boilerplate code into new files.

local M = {}

-- Isolated augroup for templating hooks to prevent global namespace pollution
local template_group = vim.api.nvim_create_augroup("CompTemplates", { clear = true })

-- Clones a base scaffold directory into a new folder and sets it as the working directory
function M.setup_directory()
    if not require("competitive.init").is_active then
        vim.notify("Cannot setup scaffold: Not in a competitive session.", vim.log.levels.WARN)
        return
    end

    local directory_name = vim.fn.input("Enter contest directory name: ")
    if directory_name == "" then
        vim.notify("Directory creation aborted.", vim.log.levels.INFO)
        return
    end

    local escaped_dir = vim.fn.shellescape(directory_name)
    -- Execute copy command silently in the background
    local output = vim.fn.system("cp -r ./scaffold " .. escaped_dir)
    if vim.v.shell_error ~= 0 then
        vim.notify("Failed to create scaffold:\n" .. output, vim.log.levels.ERROR)
        return
    end

    -- Update Neovim's internal working directory to the new contest folder
    -- Uses standard vim.cmd over vim.fn.chdir for broader legacy compatibility
    vim.cmd("cd " .. escaped_dir)
    vim.notify("Scaffold created and directory changed to: " .. directory_name, vim.log.levels.INFO)
end

-- Registers or destroys the autocommand that injects C++ templates on new file creation
function M.toggle_templates(enable)
    if enable then
        vim.api.nvim_create_autocmd("BufNewFile", {
            group = template_group,
            callback = function()
                local ft = vim.bo.filetype
                -- Limit template injection strictly to C++ source files
                if ft ~= "cpp" then return end 

                local filename = vim.fn.expand("%:t:r")
                -- Inject specific boilerplate based on contest platform keywords in the filename
                if string.find(filename, "usaco") ~= nil then
                    vim.cmd("0r ~/playground/templates/usaco.cpp")
                elseif string.find(filename, "cses") ~= nil then
                    vim.cmd("0r ~/playground/templates/cses.cpp")
                else
                    vim.cmd("0r ~/playground/templates/default.cpp")
                end
            end
        })
    else
        vim.api.nvim_clear_autocmds({ group = "CompTemplates" })
    end
end

return M
