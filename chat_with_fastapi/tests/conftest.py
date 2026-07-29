from unittest.mock import MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.fixture
def mock_db() -> MagicMock:
    return MagicMock(spec=AsyncSession)


def make_result(scalar_one_or_none=None, scalar_one=None, scalars_all=None) -> MagicMock:
    """Build a fake SQLAlchemy Result supporting the accessors services use."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar_one_or_none
    result.scalar_one.return_value = scalar_one
    result.scalars.return_value.all.return_value = scalars_all if scalars_all is not None else []
    return result
