import React, { useState, useMemo } from 'react';

export default function HistorySummaryTable({ lists, onSelect, onDelete }) {
    const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' });

    const sortedLists = useMemo(() => {
        let out = [...lists];
        out.sort((a, b) => {
            let vA = a[sort.key];
            let vB = b[sort.key];

            if (sort.key === 'createdAt') {
                vA = new Date(vA).getTime();
                vB = new Date(vB).getTime();
            }

            if (vA < vB) return sort.dir === 'asc' ? -1 : 1;
            if (vA > vB) return sort.dir === 'asc' ? 1 : -1;
            return 0;
        });
        return out;
    }, [lists, sort]);

    const toggleSort = (key) => {
        setSort(prev => ({
            key,
            dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
        }));
    };

    return (
        <div className="flex-1 bg-slate-900 text-slate-100 overflow-hidden flex flex-col p-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-widest text-white">Punch List History</h2>
                    <p className="text-slate-400 text-sm">Select a list to view details or manage punches</p>
                </div>
                <div className="bg-slate-800 border border-slate-700 px-4 py-2 rounded">
                    <span className="text-xs font-bold text-slate-500 uppercase mr-2">Total Lists:</span>
                    <span className="text-xl font-black text-amber-400">{lists.length}</span>
                </div>
            </div>

            <div className="flex-1 overflow-auto border-2 border-slate-800 bg-slate-950/30 rounded-lg">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-800 border-b-2 border-slate-700">
                        <tr>
                            <th
                                className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-400 cursor-pointer hover:text-white"
                                onClick={() => toggleSort('createdAt')}
                            >
                                Date {sort.key === 'createdAt' && (sort.dir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th
                                className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-400 cursor-pointer hover:text-white"
                                onClick={() => toggleSort('name')}
                            >
                                List Name {sort.key === 'name' && (sort.dir === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-400">
                                Punches
                            </th>
                            <th className="px-6 py-4 text-[11px] font-black uppercase tracking-wider text-slate-400 text-right">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {sortedLists.length === 0 ? (
                            <tr>
                                <td colSpan="4" className="px-6 py-12 text-center text-slate-500 italic">
                                    No punch lists found. Create a new one from the header dropdown.
                                </td>
                            </tr>
                        ) : (
                            sortedLists.map((list) => (
                                <tr
                                    key={list.id}
                                    className="group hover:bg-slate-800/40 transition-colors cursor-pointer"
                                    onClick={() => onSelect(list.id)}
                                >
                                    <td className="px-6 py-4 text-sm font-medium text-slate-400">
                                        {new Date(list.createdAt).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-base font-bold text-amber-50 group-hover:text-amber-400 transition-colors">
                                            {list.name}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-slate-500 uppercase leading-none">Open</span>
                                                <span className="text-sm font-bold text-slate-200">{list.openCount || 0}</span>
                                            </div>
                                            <div className="w-[1px] h-6 bg-slate-800"></div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-slate-500 uppercase leading-none">Closed</span>
                                                <span className="text-sm font-bold text-emerald-500">{list.closedCount || 0}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSelect(list.id);
                                                }}
                                                className="px-4 py-1.5 bg-amber-600/10 hover:bg-amber-600 text-amber-500 hover:text-white border border-amber-600/30 font-black text-[10px] uppercase tracking-widest rounded-sm transition-all shadow-sm"
                                            >
                                                Open
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm(`Are you sure you want to delete "${list.name}"?`)) {
                                                        onDelete(list.id, e);
                                                    }
                                                }}
                                                className="p-1.5 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-sm transition-all"
                                                title="Delete List"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
