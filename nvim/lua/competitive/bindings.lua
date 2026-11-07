-- ~/.config/nvim/lua/competitive/bindings.lua
-- Maps all competitive programming actions to the <leader>x namespace.
-- Relies on which-key.nvim for UI discovery.

local M = {}

function M.setup()
	local wk = require("which-key")
	local init = require("competitive.init")
	local layout = require("competitive.layout")
	local disp = require("competitive.dispatcher")
	local scaffold = require("competitive.scaffold")

	wk.add({
		{ "<leader>cc", disp.compile, desc = "Compile" },
		{ "<leader>cs", init.start_session, desc = "Start session" },
		{ "<leader>ce", init.end_session, desc = "End session" },
		{ "<leader>cS", scaffold.setup_directory, desc = "Setup scaffold" },
		{ "<leader>cl", layout.setup_layout, desc = "Competitive Layout" },
		{ "<leader>cr", disp.run, desc = "Run" },
		{ "<leader>ct", disp.get_and_run, desc = "Paste test case and Run" },
		-- Chained execution flows
		{ "<leader>cC", group = "Compile and then" },
		{ "<leader>cCr", disp.compile_and_run, desc = "Compile & Run" },
		{ "<leader>cCd", disp.compile_with_flag, desc = "Compile with debug" },
		{ "<leader>cCo", disp.compile_and_run_with_runner, desc = "Compile & Run with runner" },
	})
end

return M
