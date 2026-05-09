import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryRowView } from '../../../reader/components/library-row';

const baseRow = {
  urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
  addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
  libraryId: null, topicIds: [],
};

describe('LibraryRowView chip row', () => {
  it('renders unfiled Library chip when libraryId=null', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByLabelText('Set library')).toBeInTheDocument();
  });

  it('renders filed Library chip with name when libraryId is set', () => {
    render(<LibraryRowView row={{ ...baseRow, libraryId: 'l1' }} isCurrent={false} libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]} topics={[]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText(/Library: Q4/)).toBeInTheDocument();
  });

  it('renders one Topic chip per assigned topicId', () => {
    render(<LibraryRowView row={{ ...baseRow, topicIds: ['t1', 't2'] }} isCurrent={false} libraries={[]} topics={[{ id: 't1', name: 'VLA', createdAt: 0 }, { id: 't2', name: 'Robotics', createdAt: 0 }]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText('VLA')).toBeInTheDocument();
    expect(screen.getByText('Robotics')).toBeInTheDocument();
  });

  it('clicking the × on a Topic chip calls onUnassignTopic', () => {
    const onUnassign = vi.fn();
    render(<LibraryRowView row={{ ...baseRow, topicIds: ['t1'] }} isCurrent={false} libraries={[]} topics={[{ id: 't1', name: 'VLA', createdAt: 0 }]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={onUnassign} />);
    fireEvent.click(screen.getByLabelText('Topic: VLA, click to remove'));
    expect(onUnassign).toHaveBeenCalledWith(baseRow.urlHash, 't1');  // rowKey is the urlHash since baseRow has no id
  });

  it('renders + Set topic chip', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByLabelText('Set topic')).toBeInTheDocument();
  });

  it('renders "Also in: …" annotation when alsoInTopics prop is set', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} alsoInTopics={['Robotics', 'Multimodal']} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText('Also in: Robotics · Multimodal')).toBeInTheDocument();
  });

  it('caps "Also in:" at 3 names + +N more', () => {
    render(<LibraryRowView row={baseRow} isCurrent={false} libraries={[]} topics={[]} alsoInTopics={['A', 'B', 'C', 'D', 'E']} onAssignLibrary={() => {}} onToggleTopic={() => {}} onUnassignTopic={() => {}} />);
    expect(screen.getByText('Also in: A · B · C · +2 more')).toBeInTheDocument();
  });
});
