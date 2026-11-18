import pytest

from batter_up import __version__
from batter_up.cli import main


def test_no_command_prints_help(capsys):
    assert main([]) == 0
    assert "batter-up" in capsys.readouterr().out


def test_version(capsys):
    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out
