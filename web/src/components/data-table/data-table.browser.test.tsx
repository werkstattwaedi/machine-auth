// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach } from "vitest"
import { type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "./data-table"

afterEach(cleanup)

interface TestRow {
  name: string
  age: number
}

const columns: ColumnDef<TestRow, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "age", header: "Alter" },
]

const sampleData: TestRow[] = [
  { name: "Anna", age: 28 },
  { name: "Beat", age: 35 },
  { name: "Clara", age: 42 },
]

describe("DataTable", () => {
  it("renders column headers", () => {
    render(<DataTable columns={columns} data={sampleData} />)

    expect(screen.getByText("Name")).toBeTruthy()
    expect(screen.getByText("Alter")).toBeTruthy()
  })

  it("renders all data rows", () => {
    render(<DataTable columns={columns} data={sampleData} />)

    expect(screen.getByText("Anna")).toBeTruthy()
    expect(screen.getByText("Beat")).toBeTruthy()
    expect(screen.getByText("Clara")).toBeTruthy()
  })

  it("shows empty message when no data", () => {
    render(<DataTable columns={columns} data={[]} />)

    expect(screen.getByText("Keine Ergebnisse.")).toBeTruthy()
  })

  it("filters rows via search input", async () => {
    const user = userEvent.setup()

    render(
      <DataTable
        columns={columns}
        data={sampleData}
        searchKey="name"
        searchPlaceholder="Name suchen..."
      />,
    )

    const searchInput = screen.getByPlaceholderText("Name suchen...")
    await user.type(searchInput, "Anna")

    expect(screen.getByText("Anna")).toBeTruthy()
    expect(screen.queryByText("Beat")).toBeNull()
    expect(screen.queryByText("Clara")).toBeNull()
  })

  it("shows row count in pagination", () => {
    render(<DataTable columns={columns} data={sampleData} />)

    // Pagination shows row count as "X Einträge"
    expect(screen.getByText(/3\s+Einträge/)).toBeTruthy()
  })
})
