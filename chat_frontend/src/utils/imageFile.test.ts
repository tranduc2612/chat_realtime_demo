import { describe, expect, it } from 'vitest';
import { MAX_AVATAR_BYTES, IMAGE_ACCEPT_ATTR, validateImageFile } from './imageFile';

function fakeFile(type: string, size: number, name = 'a.png'): File {
  const file = new File(['x'], name, { type });
  // File size is read-only, and building a real 6MB blob just to test a
  // comparison would be wasteful.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('validateImageFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])('accepts %s', (type) => {
    expect(validateImageFile(fakeFile(type, 1024))).toBeNull();
  });

  it('rejects a non-image type', () => {
    expect(validateImageFile(fakeFile('application/pdf', 1024, 'a.pdf'))).toMatch(/JPEG, PNG, GIF and WebP/);
  });

  it('rejects a file over the size limit', () => {
    expect(validateImageFile(fakeFile('image/png', MAX_AVATAR_BYTES + 1))).toMatch(/too large/);
  });

  it('accepts a file exactly at the limit', () => {
    expect(validateImageFile(fakeFile('image/png', MAX_AVATAR_BYTES))).toBeNull();
  });

  it('rejects an empty file', () => {
    expect(validateImageFile(fakeFile('image/png', 0))).toMatch(/empty/);
  });
});

describe('IMAGE_ACCEPT_ATTR', () => {
  it('lists the same types the validator accepts', () => {
    expect(IMAGE_ACCEPT_ATTR).toBe('image/jpeg,image/jpg,image/png,image/gif,image/webp');
  });
});
