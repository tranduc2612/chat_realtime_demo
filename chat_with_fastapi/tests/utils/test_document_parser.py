import io

import pytest

from app.utils.document_parser import (
    UnsupportedDocumentError,
    chunk_text,
    extension_of,
    extract_text,
    is_supported,
)


# ── extension handling ──────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "filename,expected",
    [
        ("policy.PDF", ".pdf"),
        ("notes.md", ".md"),
        ("archive.tar.gz", ".gz"),
        ("no-extension", ""),
    ],
)
def test_extension_of(filename, expected):
    assert extension_of(filename) == expected


def test_is_supported():
    assert is_supported("handbook.docx")
    assert is_supported("README.MD")
    assert not is_supported("payload.exe")


def test_extract_text_rejects_unsupported_type():
    with pytest.raises(UnsupportedDocumentError):
        extract_text("payload.exe", b"whatever")


# ── extraction ──────────────────────────────────────────────────────────────

def test_extract_text_plain_normalizes_whitespace():
    raw = b"# Title\r\n\r\nHello    world  \r\n\r\n\r\n\r\nBye"
    # CRLF collapsed, runs of spaces squeezed, 3+ blank lines reduced to one.
    assert extract_text("a.md", raw) == "# Title\n\nHello world\n\nBye"


def test_extract_text_decodes_invalid_utf8_without_raising():
    result = extract_text("a.txt", b"caf\xe9 latte")
    assert "latte" in result


def test_extract_text_html_drops_script_and_style():
    raw = b"<html><style>p{color:red}</style><body><h1>Hi</h1>"
    raw += b"<script>alert(1)</script><p>There</p></body></html>"
    result = extract_text("a.html", raw)

    assert "Hi" in result and "There" in result
    assert "alert" not in result and "color:red" not in result


def test_extract_text_docx_includes_paragraphs_and_tables():
    docx = pytest.importorskip("docx")

    document = docx.Document()
    document.add_paragraph("Vacation policy")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Region"
    table.rows[0].cells[1].text = "Days"

    buffer = io.BytesIO()
    document.save(buffer)

    result = extract_text("policy.docx", buffer.getvalue())

    assert "Vacation policy" in result
    # Table content is not part of `document.paragraphs` and must be pulled
    # in separately — internal docs keep a lot of the real detail in tables.
    assert "Region | Days" in result


# ── chunking ────────────────────────────────────────────────────────────────

def test_chunk_text_empty_input():
    assert chunk_text("", 100, 10) == []
    assert chunk_text("   \n\n  ", 100, 10) == []


def test_chunk_text_short_text_is_one_chunk():
    assert chunk_text("Just a sentence.", 1000, 100) == ["Just a sentence."]


def test_chunk_text_rejects_non_positive_size():
    with pytest.raises(ValueError):
        chunk_text("text", 0, 0)


def test_chunk_text_splits_on_paragraph_boundaries():
    text = "\n\n".join(f"Paragraph {i} " + "word " * 20 for i in range(6))
    chunks = chunk_text(text, chunk_size=300, overlap=0)

    assert len(chunks) > 1
    assert all(len(chunk) <= 300 for chunk in chunks)
    # Every paragraph survives somewhere.
    for i in range(6):
        assert any(f"Paragraph {i}" in chunk for chunk in chunks)


def test_chunk_text_overlap_carries_tail_of_previous_chunk():
    text = "\n\n".join(f"Para{i} " + "word " * 30 for i in range(4))
    chunks = chunk_text(text, chunk_size=300, overlap=80)

    assert len(chunks) > 1
    for previous, current in zip(chunks, chunks[1:]):
        # The overlap prefix is drawn from the end of the preceding chunk.
        prefix = current.split("\n\n")[0]
        assert prefix and prefix in previous


def test_chunk_text_splits_paragraph_longer_than_chunk_size():
    text = "word " * 500  # one ~2500-char paragraph
    chunks = chunk_text(text, chunk_size=400, overlap=0)

    assert len(chunks) > 1
    assert all(len(chunk) <= 400 for chunk in chunks)


def test_chunk_text_hard_cuts_text_with_no_whitespace():
    # Minified content or CJK has no space to break on — it must still be
    # chunked rather than emitted as one oversized blob.
    chunks = chunk_text("x" * 1000, chunk_size=300, overlap=0)

    assert len(chunks) > 1
    assert all(len(chunk) <= 300 for chunk in chunks)
    assert "".join(chunks) == "x" * 1000


def test_chunk_text_clamps_overlap_below_chunk_size():
    # An overlap >= chunk_size would otherwise recurse or produce empty chunks.
    chunks = chunk_text("\n\n".join(f"Para{i} " + "word " * 20 for i in range(4)), 300, 9999)
    assert all(chunk.strip() for chunk in chunks)
