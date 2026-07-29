import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Avatar from './Avatar';

describe('Avatar', () => {
  it('renders an image with the given alt text when src is provided', () => {
    render(<Avatar src="http://x/pic.png" name="Alice" />);
    const img = screen.getByRole('img', { name: 'Alice' });
    expect(img).toHaveAttribute('src', 'http://x/pic.png');
  });

  it('renders the fallback silhouette when no src is given', () => {
    render(<Avatar name="Alice" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back to the silhouette after the image fails to load', () => {
    render(<Avatar src="http://x/broken.png" name="Alice" />);
    const img = screen.getByRole('img', { name: 'Alice' });

    fireEvent.error(img);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('renders the online indicator when online is explicitly true or false, but not when omitted', () => {
    const { container: withTrue } = render(<Avatar name="A" online={true} />);
    expect(withTrue.querySelectorAll('span.absolute')).toHaveLength(1);

    const { container: withFalse } = render(<Avatar name="A" online={false} />);
    expect(withFalse.querySelectorAll('span.absolute')).toHaveLength(1);

    const { container: withOmitted } = render(<Avatar name="A" />);
    expect(withOmitted.querySelectorAll('span.absolute')).toHaveLength(0);
  });
});
