import Papa from "papaparse";

export function parseCsvText<T>(csvText: string): Promise<{
  data: T[];
  errors: Papa.ParseError[];
  meta: Papa.ParseMeta;
}> {
  return new Promise((resolve, reject) => {
    try {
      Papa.parse<T>(csvText, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (results) => {
          resolve({
            data: results.data,
            errors: results.errors,
            meta: results.meta,
          });
        },
        error: (error: any) => {
          reject(error);
        },
      });
    } catch (err) {
      reject(err);
    }
  });
}
